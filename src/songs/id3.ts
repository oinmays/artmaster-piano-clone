/** Title and artist tags from audio file bytes: ID3v2/ID3v1 (MP3), MP4 ilst (M4A), RIFF INFO (WAV). (T25 — stub) */
import type { NameMeta } from './naming';

/** Never throws; {} when there are no tags or the bytes are not understood. Only needs the first ~512 KB plus the last 128 bytes for ID3v1 — callers may pass the whole file. */
export function readAudioTags(_bytes: Uint8Array): NameMeta {
  return {};
}
