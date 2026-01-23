import sampleImage1 from './resized/sample_image1.jpg';
import sampleImage2 from './resized/sample_image2.jpg';
import sampleImage3 from './resized/sample_image3.jpg';
import sampleImage4 from './resized/sample_image4.jpg';
import sampleImage5 from './resized/sample_image5.jpg';
import sampleImage6 from './resized/sample_image6.jpg';
import sampleImage7 from './resized/sample_image7.jpg';
import sampleImage8 from './resized/sample_image8.jpg';
import sampleImage9 from './resized/sample_image9.jpg';
import sampleImage10 from './resized/sample_image10.jpg';

export type Post = {
    id: string;
    location: { lng: number; lat: number; placeName?: string; area?: string };
    caption: string;
    photos: { url: string }[];
    author: { id: string; name: string; avatarUrl?: string };
    createdAt: string;
};

export const MOCK_POSTS: Post[] = [
    {
        id: 'post-1',
        location: { lng: 139.7625, lat: 35.681, placeName: '東京駅丸の内', area: '千代田区' },
        caption: '赤レンガが夜に映えて最高。',
        photos: [{ url: sampleImage1 }],
        author: { id: 'user-1', name: 'KAZUNE' },
        createdAt: '2024-05-12T20:45:00+09:00',
    },
    {
        id: 'post-2',
        location: { lng: 139.7454, lat: 35.6586, placeName: '東京タワー', area: '港区' },
        caption: '夕景から夜景まで見渡せる。',
        photos: [{ url: sampleImage2 }],
        author: { id: 'user-2', name: 'MIO' },
        createdAt: '2024-04-02T19:10:00+09:00',
    },
    {
        id: 'post-3',
        location: { lng: 139.7741, lat: 35.7138, placeName: '上野公園', area: '台東区' },
        caption: '水面の反射がきれい。',
        photos: [{ url: sampleImage3 }],
        author: { id: 'user-3', name: 'RYO' },
        createdAt: '2024-03-18T21:05:00+09:00',
    },
    {
        id: 'post-4',
        location: { lng: 139.7006, lat: 35.6938, placeName: '都庁展望室', area: '新宿区' },
        caption: '街の光が広がって見える。',
        photos: [{ url: sampleImage4 }],
        author: { id: 'user-4', name: 'SORA' },
        createdAt: '2024-02-24T18:30:00+09:00',
    },
    {
        id: 'post-5',
        location: { lng: 139.4601, lat: 35.6429, placeName: '稲城中央公園', area: '稲城市' },
        caption: '高台から街の灯りが見える。',
        photos: [{ url: sampleImage5 }],
        author: { id: 'user-5', name: 'HARU' },
        createdAt: '2024-02-10T20:15:00+09:00',
    },
    {
        id: 'post-6',
        location: { lng: 139.3388, lat: 35.6667, placeName: '八王子城跡', area: '八王子市' },
        caption: '静かな夜景で落ち着く。',
        photos: [{ url: sampleImage6 }],
        author: { id: 'user-6', name: 'MEI' },
        createdAt: '2024-01-28T19:40:00+09:00',
    },
    {
        id: 'post-7',
        location: { lng: 139.4174, lat: 35.6544, placeName: '多摩センター', area: '多摩市' },
        caption: '広場の光が柔らかい。',
        photos: [{ url: sampleImage7 }],
        author: { id: 'user-7', name: 'REN' },
        createdAt: '2024-01-12T21:20:00+09:00',
    },
    {
        id: 'post-8',
        location: { lng: 139.3236, lat: 35.6596, placeName: '高尾山口', area: '八王子市' },
        caption: '山の空気と夜景が最高。',
        photos: [{ url: sampleImage8 }],
        author: { id: 'user-8', name: 'AI' },
        createdAt: '2023-12-22T18:55:00+09:00',
    },
    {
        id: 'post-9',
        location: { lng: 139.4462, lat: 35.6245, placeName: 'よみうりランド', area: '稲城市' },
        caption: 'イルミと夜景が相性抜群。',
        photos: [{ url: sampleImage9 }],
        author: { id: 'user-9', name: 'KENTO' },
        createdAt: '2023-12-08T19:05:00+09:00',
    },
    {
        id: 'post-10',
        location: { lng: 139.4706, lat: 35.6812, placeName: '府中の森公園', area: '府中市' },
        caption: '夜の散歩にちょうどいい。',
        photos: [{ url: sampleImage10 }],
        author: { id: 'user-10', name: 'NANA' },
        createdAt: '2023-11-26T20:10:00+09:00',
    },
];
