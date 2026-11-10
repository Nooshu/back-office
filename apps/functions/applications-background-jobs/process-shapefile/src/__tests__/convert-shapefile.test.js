import { describe, expect, it } from '@jest/globals';
import JSZip from 'jszip';
import {
	normalisePrjDatumNames,
	normaliseShapefileZipPrjs,
	shpZipToGeoJson
} from '../convert-shapefile.js';

// a British National Grid point on the A1 near Birtley (NZ 270 560): the .shp record below
// holds it, and a correct OSGB36 -> WGS84 conversion lands it at ~[-1.580524, 54.898006]
const BNG_POINT = [427000, 556000];
const EXPECTED_WGS84 = [-1.580524, 54.898006];

// the same EPSG:27700 .prj written the two ways real exports write it: the ESRI spelling
// 'D_OSGB_1936' resolves a datum transformation, the OGC spelling 'OSGB 1936' resolved to
// no datum at all - dropping the ~50-150m OSGB36 -> WGS84 shift
const PRJ_ESRI =
	'PROJCS["OSGB_1936_British_National_Grid",GEOGCS["GCS_OSGB_1936",DATUM["D_OSGB_1936",SPHEROID["Airy_1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",49],PARAMETER["central_meridian",-2],PARAMETER["scale_factor",0.9996012717],PARAMETER["false_easting",400000],PARAMETER["false_northing",-100000],UNIT["Meter",1]]';
const PRJ_OGC =
	'PROJCS["OSGB 1936 / British National Grid",GEOGCS["OSGB 1936",DATUM["OSGB 1936",SPHEROID["Airy 1830",6377563.396,299.324961257]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",49],PARAMETER["central_meridian",-2],PARAMETER["scale_factor",0.9996012717],PARAMETER["false_easting",400000],PARAMETER["false_northing",-100000],UNIT["metre",1]]';

/** A minimal .shp holding a single Point record at `position`. */
const pointShp = ([x, y]) => {
	const buffer = new ArrayBuffer(128); // 100-byte header + 8-byte record header + 20-byte point
	const view = new DataView(buffer);
	view.setInt32(0, 9994); // file code (big-endian)
	view.setInt32(24, 64); // file length in 16-bit words (big-endian)
	view.setInt32(28, 1000, true); // version (little-endian)
	view.setInt32(32, 1, true); // shape type: Point
	for (const [offset, value] of [
		[36, x],
		[44, y],
		[52, x],
		[60, y]
	]) {
		view.setFloat64(offset, value, true); // bounding box
	}
	view.setInt32(100, 1); // record number (big-endian)
	view.setInt32(104, 10); // record content length in 16-bit words (big-endian)
	view.setInt32(108, 1, true); // record shape type: Point
	view.setFloat64(112, x, true);
	view.setFloat64(120, y, true);
	return buffer;
};

const shapefileZip = async (prj) =>
	new JSZip()
		.file('boundary.shp', pointShp(BNG_POINT))
		.file('boundary.prj', prj)
		.generateAsync({ type: 'nodebuffer' });

describe('normalisePrjDatumNames', () => {
	it('underscores a spaced DATUM name', () => {
		expect(normalisePrjDatumNames('DATUM["OSGB 1936"]')).toBe('DATUM["OSGB_1936"]');
	});

	it('leaves an underscored DATUM name alone', () => {
		expect(normalisePrjDatumNames(PRJ_ESRI)).toBe(PRJ_ESRI);
	});

	it('underscores every DATUM name in the WKT', () => {
		expect(normalisePrjDatumNames(PRJ_OGC)).toContain('DATUM["OSGB_1936"');
	});
});

describe('normaliseShapefileZipPrjs', () => {
	it('returns the buffer unchanged when no .prj needs rewriting', async () => {
		const zipBuffer = await shapefileZip(PRJ_ESRI);
		expect(await normaliseShapefileZipPrjs(zipBuffer)).toBe(zipBuffer);
	});
});

describe('shpZipToGeoJson', () => {
	it('reprojects an OGC-spelled OSGB 1936 .prj with the datum transformation', async () => {
		const geoJson = await shpZipToGeoJson(await shapefileZip(PRJ_OGC));

		const [lon, lat] = geoJson.features[0].geometry.coordinates;
		expect(lon).toBeCloseTo(EXPECTED_WGS84[0], 5);
		expect(lat).toBeCloseTo(EXPECTED_WGS84[1], 5);
	});

	it('converts ESRI- and OGC-spelled .prj files identically', async () => {
		const [fromEsri, fromOgc] = await Promise.all([
			shpZipToGeoJson(await shapefileZip(PRJ_ESRI)),
			shpZipToGeoJson(await shapefileZip(PRJ_OGC))
		]);

		// not literally equal - the two .prj spellings carry slightly different spheroid
		// flattening constants, a difference of about a tenth of a millimetre
		const [esriLon, esriLat] = fromEsri.features[0].geometry.coordinates;
		const [ogcLon, ogcLat] = fromOgc.features[0].geometry.coordinates;
		expect(ogcLon).toBeCloseTo(esriLon, 6);
		expect(ogcLat).toBeCloseTo(esriLat, 6);
	});
});
