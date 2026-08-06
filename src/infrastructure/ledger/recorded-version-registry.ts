import { appError } from "@contracts/errors";

interface RecordedVersion<T> {
  readonly schemaVersion: string;
  readonly serializerVersion: string;
  readonly discriminator?: string;
  readonly codec: T;
}

export interface RecordedVersionRegistry<T> {
  resolve(
    schemaVersion: string,
    serializerVersion: string,
    discriminator?: string,
  ): T | undefined;
}

function versionKey(
  schemaVersion: string,
  serializerVersion: string,
  discriminator?: string,
): string {
  return `${discriminator ?? ""}|${schemaVersion}|${serializerVersion}`;
}

export function createRecordedVersionRegistry<T>(
  versions: readonly RecordedVersion<T>[],
): RecordedVersionRegistry<T> {
  const entries = new Map<string, T>();
  for (const version of versions) {
    const key = versionKey(
      version.schemaVersion,
      version.serializerVersion,
      version.discriminator,
    );
    if (entries.has(key)) {
      throw appError("VALIDATION", `duplicate recorded encoding ${key}`);
    }
    entries.set(key, version.codec);
  }
  return {
    resolve(schemaVersion, serializerVersion, discriminator) {
      return entries.get(versionKey(
        schemaVersion,
        serializerVersion,
        discriminator,
      ));
    },
  };
}
