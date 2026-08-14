/**
 * One logical piece of a source, before splitting.
 *
 * `page` survives all the way into chunk metadata, which is what lets the UI
 * cite "page 7" instead of an opaque chunk id. Sources without pagination
 * (YouTube, web) leave it undefined rather than faking a number.
 */
export interface LoadedSection {
  text: string;
  page?: number;
}

export interface LoadedSource {
  title: string;
  sections: LoadedSection[];
}
