import JSZip from 'jszip';
import shpjs from 'shpjs';

/**
 * Rewrites a .prj's DATUM names with underscores where they were written with spaces.
 *
 * shpjs reprojects with proj4, whose WKT parser only maps datum names to a real datum
 * (and so to a datum transformation) when the name is underscored - 'OSGB_1936' resolves
 * to 'osgb36' and its to-WGS84 parameters. Written the OGC way, 'OSGB 1936', the name
 * resolves to no datum at all, so the OSGB36 -> WGS84 shift is silently skipped and
 * every coordinate lands ~50-150m out. Underscoring is safe the other way too: proj4's
 * own datum lookup already ignores spaces, so any name it could resolve before still
 * resolves after.
 *
 * @param {string} prj - a .prj's WKT contents
 * @returns {string} the same WKT, with DATUM names underscored
 */
export const normalisePrjDatumNames = (prj) =>
	prj.replace(
		/(DATUM\s*\[\s*")([^"]*)(")/g,
		(match, open, name, close) => `${open}${name.replace(/ /g, '_')}${close}`
	);

/**
 * Rewrites every .prj in a shapefile ZIP whose DATUM names need it, and returns the
 * (re-)zipped buffer for shpjs.
 *
 * @param {Buffer} zipBuffer
 * @returns {Promise<Buffer>}
 */
export const normaliseShapefileZipPrjs = async (zipBuffer) => {
	const zip = await JSZip.loadAsync(zipBuffer);
	const prjNames = Object.keys(zip.files).filter(
		(name) => !zip.files[name].dir && name.toLowerCase().endsWith('.prj')
	);
	let changed = false;
	for (const name of prjNames) {
		const original = await zip.files[name].async('string');
		const normalised = normalisePrjDatumNames(original);
		if (normalised !== original) {
			zip.file(name, normalised);
			changed = true;
		}
	}
	if (!changed) {
		return zipBuffer;
	}
	return zip.generateAsync({ type: 'nodebuffer' });
};

/**
 * Converts a shapefile ZIP buffer to a GeoJSON FeatureCollection.
 * shpjs handles ZIP extraction, .shp parsing and .dbf attribute merging internally.
 *
 * @param {Buffer} zipBuffer
 * @returns {Promise<object>} GeoJSON FeatureCollection
 */
export const shpZipToGeoJson = async (zipBuffer) => {
	const result = await shpjs(await normaliseShapefileZipPrjs(zipBuffer));
	// shpjs returns either a FeatureCollection or an array of them (for multi-layer ZIPs)
	if (Array.isArray(result)) {
		return { type: 'FeatureCollection', features: result.flatMap((fc) => fc.features) };
	}
	return result;
};
