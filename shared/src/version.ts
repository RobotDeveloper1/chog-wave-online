/**
 * What the game calls itself and which build the player is looking at.
 *
 * One place, so the HUD label, the server's `/health` and the boot log can never disagree.
 * It is a *build* number, bumped by hand when a build is cut for someone to play; it is not
 * the npm package version.
 */
export const GAME_NAME = 'CHOG WAVE';
export const BUILD_VERSION = '0.0.5b';
/** The name this build carries on screen: shown beside the version in the top-right stamp. */
export const BUILD_TAG = 'Chogathon build';
