/** Shared by the browser and the server (no Node imports here). */
export const PART_BYTES = 32 * 1024 * 1024        // R2 needs ≥ 5 MiB per part (except the last); 32 MiB × 10 000 parts = 320 GB
export const MULTIPART_MIN_BYTES = 64 * 1024 * 1024
export const MAX_PARTS = 10_000
