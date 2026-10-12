/**
 * What the game calls itself and which build the player is looking at.
 *
 * One place, so the HUD label, the server's `/health` and the boot log can never disagree.
 * It is a *build* number, bumped by hand when a build is cut for someone to play; it is not
 * the npm package version.
 */
export const GAME_NAME = 'CHOG WAVES';
export const BUILD_VERSION = '0.0.2';
