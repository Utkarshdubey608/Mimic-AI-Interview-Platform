/**
 * The marketing scroll module.
 *
 * `progress` is pure arithmetic, `ScrollProvider` owns the site's only scroll
 * loop, and the components consume both. Import from here rather than reaching
 * into the files.
 */
export { clamp01, easeInOutCubic, stepProgress, sectionProgress, deckHead, type StepState } from './progress'
export { useScrollEngine, scrollToAnchor, onScrollTick } from './ScrollProvider'
export { SplitText } from './SplitText'
export { PinnedStage } from './PinnedStage'
