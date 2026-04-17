export type CameraStyle = "locked" | "push_in" | "two_shot";
export type StudioBackground = "midnight" | "newsroom" | "warm_studio" | "city";
export type SubtitleStyle = "minimal" | "karaoke" | "podcast";
export type AspectRatio = "16:9" | "9:16" | "1:1";

export interface VideoSettings {
  background: StudioBackground;
  backgroundUrl?: string;
  cameraStyle: CameraStyle;
  subtitlesEnabled: boolean;
  subtitleStyle: SubtitleStyle;
  aspectRatio: AspectRatio;
  resolution: "720p" | "1080p" | "4k";
}
