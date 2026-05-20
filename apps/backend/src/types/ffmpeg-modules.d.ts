declare module 'ffmpeg-static' {
  const ffmpegPath: string | null;
  export default ffmpegPath;
}

declare module 'fluent-ffmpeg' {
  type FfmpegCommand = {
    input(input: string): FfmpegCommand;
    complexFilter(filters: string | string[]): FfmpegCommand;
    outputOptions(options: string[]): FfmpegCommand;
    output(path: string): FfmpegCommand;
    on(event: 'end', listener: () => void): FfmpegCommand;
    on(event: 'error', listener: (err: unknown) => void): FfmpegCommand;
    run(): void;
  };

  interface FfmpegStatic {
    (input?: string): FfmpegCommand;
    setFfmpegPath(path: string): void;
  }

  const ffmpeg: FfmpegStatic;
  export default ffmpeg;
}
