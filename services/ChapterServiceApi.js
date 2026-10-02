/**
 * services/ChapterServiceApi.js
 * @deprecated Chapter functions have been consolidated into TestSeriesServiceApi.js.
 * This file is a re-export shim for backwards compatibility — import directly from
 * TestSeriesServiceApi instead.
 */
export {
  fetchChapters,
  createChapter,
  updateChapter,
  deleteChapter,
} from "./TestSeriesServiceApi";
