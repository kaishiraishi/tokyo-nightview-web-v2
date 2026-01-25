import type { Post } from '../../lib/postsApi';
import { LayerSettings } from '../layout/LayerSettings';

type PostListPanelProps = {
    posts: Post[];
    isLoading?: boolean;
    onPostClick: (post: Post) => void;
    // Layer settings props
    viirsEnabled: boolean;
    setViirsEnabled: (enabled: boolean) => void;
    aerialEnabled: boolean;
    setAerialEnabled: (enabled: boolean) => void;
};

export function PostListPanel({ 
    posts, 
    isLoading, 
    onPostClick,
    viirsEnabled,
    setViirsEnabled,
    aerialEnabled,
    setAerialEnabled
}: PostListPanelProps) {
    if (isLoading) {
        return <div className="p-8 text-center text-white/50 text-sm">読み込み中...</div>;
    }

    if (posts.length === 0) {
        return (
            <div className="p-8 text-center flex flex-col items-center gap-2">
                <span className="text-2xl opacity-30">📭</span>
                <p className="text-white/50 text-sm">まだ投稿がありません</p>
                <p className="text-white/30 text-xs text-center">
                    右下のカメラボタンから<br/>最初の投稿をしてみましょう
                </p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full bg-transparent text-white">
            <div className="px-4 py-4 border-b border-white/10 shrink-0 flex justify-between items-baseline">
                <div className="text-xs text-white/50 font-medium tracking-wider">LATEST POSTS</div>
                <div className="text-xs text-white/40">{posts.length}件</div>
            </div>

            {/* Layer Settings Section */}
            <LayerSettings
                viirsEnabled={viirsEnabled}
                setViirsEnabled={setViirsEnabled}
                aerialEnabled={aerialEnabled}
                setAerialEnabled={setAerialEnabled}
            />
            
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
                {posts.map((post) => (
                    <div 
                        key={post.id}
                        onClick={() => onPostClick(post)}
                        className="group bg-white/5 hover:bg-white/10 border border-white/5 hover:border-white/20 rounded-xl p-3 cursor-pointer transition-all active:scale-[0.98]"
                    >
                        <div className="flex gap-3">
                            {/* Thumbnail or Icon */}
                            <div className="w-16 h-16 shrink-0 bg-black/40 rounded-lg overflow-hidden border border-white/10 flex items-center justify-center">
                                {post.photos?.[0]?.url ? (
                                    <img 
                                        src={post.photos[0].url} 
                                        alt="投稿画像" 
                                        className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" 
                                        loading="lazy"
                                    />
                                ) : (
                                    <span className="text-2xl opacity-30">🌉</span>
                                )}
                            </div>
                            
                            {/* Text Content */}
                            <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                                <div>
                                    <p className="text-sm text-white/90 line-clamp-2 font-medium leading-relaxed">
                                        {post.caption || "（コメントなし）"}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-white/40">
                                    <span className="truncate max-w-[120px]">
                                        📍 {post.location.placeName || post.location.area || '場所不明'}
                                    </span>
                                    <span>•</span>
                                    <span>{new Date(post.createdAt).toLocaleDateString()}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
