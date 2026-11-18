/**
 * Cloudinary image URLs for the gravestone photographs uploaded by
 * backend/media.py.
 */

const CLOUD_NAME = 'l02apduh';

/**
 * The delivery URL of a photo, with a transformation applied.
 *
 * @param {string} publicId The photo's Cloudinary public ID.
 * @param {string} transform A Cloudinary transformation, e.g. 'c_fill,w_120,h_120'.
 * @returns {string} The image URL.
 */
export function photoUrl(publicId, transform) {
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${transform}/v1/${publicId}`;
}

/** A square thumbnail of the given size in pixels (sharp on 2x screens). */
export function thumbnailUrl(publicId, size) {
  return photoUrl(publicId, `c_fill,w_${size * 2},h_${size * 2},q_auto,f_auto`);
}

/** The full-size photo for the lightbox, at most 2048 px on its long side. */
export function fullUrl(publicId) {
  return photoUrl(publicId, 'c_limit,w_2048,h_2048,q_auto,f_auto');
}
