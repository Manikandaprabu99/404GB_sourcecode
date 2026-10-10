/** One album in manifest/albums.json (the file is a JSON array of these). */
export interface Album {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  /** Media id shown as the album cover; defaults to the first item. */
  coverId?: string;
  mediaIds: string[];
}
