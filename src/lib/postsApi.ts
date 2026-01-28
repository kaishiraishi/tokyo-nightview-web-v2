import { supabase, isSupabaseConfigured } from './supabaseClient';

// 画像リサイズの設定
const MAX_IMAGE_WIDTH = 1200;
const MAX_IMAGE_HEIGHT = 1200;
const IMAGE_QUALITY = 0.8; // JPEG品質（0-1）

/**
 * 画像をリサイズする（Canvas API使用）
 * アスペクト比を維持しながら最大サイズ以下にリサイズ
 */
async function resizeImage(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            // 最大サイズを超える場合のみリサイズ
            if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT) {
                const ratio = Math.min(
                    MAX_IMAGE_WIDTH / width,
                    MAX_IMAGE_HEIGHT / height
                );
                width = Math.round(width * ratio);
                height = Math.round(height * ratio);
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject(new Error('Canvas context not available'));
                return;
            }

            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create blob'));
                    }
                },
                'image/jpeg',
                IMAGE_QUALITY
            );
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = URL.createObjectURL(file);
    });
}

// Supabase posts テーブルの行の型
export type DbPost = {
    id: string;           // uuid (自動生成)
    message: string;      // 必須
    photo_url: string | null;
    lat: number | null;
    lng: number | null;
    created_at: string;   // timestamptz
};

// フロント用に変換した型（既存の Post 型に近い形）
export type Post = {
    id: string;
    location: { lng: number; lat: number; placeName?: string; area?: string };
    caption: string;
    photos: { url: string }[];
    author: { id: string; name: string; avatarUrl?: string };
    createdAt: string;
    source?: 'supabase' | 'mock';
};

// DB行 → フロント用 Post に変換
function dbPostToPost(row: DbPost): Post {
    return {
        id: row.id,
        location: {
            lng: row.lng ?? 0,
            lat: row.lat ?? 0,
        },
        caption: row.message,
        photos: row.photo_url ? [{ url: row.photo_url }] : [],
        author: { id: 'anonymous', name: '匿名' },
        createdAt: row.created_at,
        source: 'supabase',
    };
}

/**
 * 投稿一覧を取得（新しい順）
 */
export async function listPosts(): Promise<Post[]> {
    if (!isSupabaseConfigured || !supabase) {
        console.warn('[postsApi] Supabase 未設定のため空配列を返します');
        return [];
    }

    const { data, error } = await supabase
        .from('posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

    if (error) {
        console.error('[postsApi] listPosts エラー:', error);
        return [];
    }

    return (data as DbPost[]).map(dbPostToPost);
}

/**
 * 新規投稿を作成
 */
export async function createPost(params: {
    message: string;
    photoUrl?: string;
    lat?: number;
    lng?: number;
}): Promise<Post> {
    if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase が設定されていないため投稿できません');
    }

    const { message, photoUrl, lat, lng } = params;

    if (!message.trim()) {
        throw new Error('メッセージは必須です');
    }

    const { data, error } = await supabase
        .from('posts')
        .insert({
            message: message.trim(),
            photo_url: photoUrl?.trim() || null,
            lat: lat ?? null,
            lng: lng ?? null,
        })
        .select()
        .single();

    if (error) {
        console.error('[postsApi] createPost エラー:', error);
        throw new Error(`投稿の保存に失敗しました: ${error.message}`);
    }

    return dbPostToPost(data as DbPost);
}

/**
 * 写真を Supabase Storage にアップロード（自動リサイズ付き）
 */
export async function uploadPhoto(file: File): Promise<string> {
    if (!isSupabaseConfigured || !supabase) {
        throw new Error('Supabase が設定されていないためアップロードできません');
    }

    // 画像をリサイズ（最大1200x1200、JPEG圧縮）
    let uploadData: Blob | File = file;
    try {
        uploadData = await resizeImage(file);
        console.log(`[postsApi] 画像リサイズ完了: ${file.size} bytes → ${uploadData.size} bytes`);
    } catch (err) {
        console.warn('[postsApi] リサイズ失敗、元画像を使用:', err);
        uploadData = file;
    }

    // ファイル名の生成 (現在時刻 + ランダム文字列、リサイズ後はJPEG固定)
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}.jpg`;
    const filePath = `${fileName}`;
    const { error: uploadError } = await supabase.storage
        .from('post-photos') // バケット名を 'post-photos' に統一
        .upload(filePath, uploadData, {
            contentType: 'image/jpeg',
            cacheControl: '3600',
            upsert: false
        });

    if (uploadError) {
        console.error('[postsApi] uploadPhoto エラー:', uploadError);
        throw new Error(`画像のアップロードに失敗しました: ${uploadError.message}`);
    }

    // 公開URLを取得
    const { data } = supabase.storage
        .from('post-photos')
        .getPublicUrl(filePath);

    return data.publicUrl;
}
