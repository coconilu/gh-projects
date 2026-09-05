// 把 64x64 的原图标双线性放大到 1024x1024，作为 tauri icon 的源图
// 用法: node scripts/upscale-icon.mjs [in.png] [out.png]
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const iconsDir = path.join(import.meta.dirname, "..", "src-tauri", "icons");
const inFile = process.argv[2] ?? path.join(iconsDir, "icon.png");
const outFile = process.argv[3] ?? path.join(iconsDir, "icon.png");
const S = 1024;

function decodePng(buf) {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG 文件");
	let pos = 8;
	let w = 0;
	let h = 0;
	let bitDepth = 0;
	let colorType = 0;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const type = buf.toString("ascii", pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (type === "IHDR") {
			w = data.readUInt32BE(0);
			h = data.readUInt32BE(4);
			bitDepth = data[8];
			colorType = data[9];
		} else if (type === "IDAT") idat.push(data);
		else if (type === "IEND") break;
		pos += 12 + len;
	}
	if (bitDepth !== 8 || colorType !== 6)
		throw new Error(
			`仅支持 8bit RGBA PNG（当前 bitDepth=${bitDepth} colorType=${colorType}）`,
		);
	const raw = zlib.inflateSync(Buffer.concat(idat));
	const bpp = 4;
	const stride = w * bpp;
	const px = Buffer.alloc(w * h * bpp);
	for (let y = 0; y < h; y++) {
		const filter = raw[y * (stride + 1)];
		const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
		const prev = y > 0 ? px.subarray((y - 1) * stride, y * stride) : null;
		const cur = px.subarray(y * stride, (y + 1) * stride);
		for (let x = 0; x < stride; x++) {
			const a = x >= bpp ? cur[x - bpp] : 0;
			const b = prev ? prev[x] : 0;
			const c = x >= bpp && prev ? prev[x - bpp] : 0;
			let v = line[x];
			if (filter === 1) v += a;
			else if (filter === 2) v += b;
			else if (filter === 3) v += (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			cur[x] = v & 0xff;
		}
	}
	return { w, h, px };
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(body) >>> 0);
	return Buffer.concat([len, body, crc]);
}

function encodePng(w, h, px) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const raw = Buffer.alloc((w * 4 + 1) * h);
	for (let y = 0; y < h; y++) {
		raw[y * (w * 4 + 1)] = 0;
		px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
	}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const src = decodePng(fs.readFileSync(inFile));
if (src.w >= S) {
	console.log(`源图已 ${src.w}x${src.h}，无需放大`);
	process.exit(0);
}
const out = Buffer.alloc(S * S * 4);
for (let y = 0; y < S; y++) {
	const sy = ((y + 0.5) / S) * src.h - 0.5;
	const y0 = Math.max(0, Math.floor(sy));
	const y1 = Math.min(src.h - 1, y0 + 1);
	const fy = sy - y0;
	for (let x = 0; x < S; x++) {
		const sx = ((x + 0.5) / S) * src.w - 0.5;
		const x0 = Math.max(0, Math.floor(sx));
		const x1 = Math.min(src.w - 1, x0 + 1);
		const fx = sx - x0;
		for (let k = 0; k < 4; k++) {
			const p00 = src.px[(y0 * src.w + x0) * 4 + k];
			const p10 = src.px[(y0 * src.w + x1) * 4 + k];
			const p01 = src.px[(y1 * src.w + x0) * 4 + k];
			const p11 = src.px[(y1 * src.w + x1) * 4 + k];
			const top = p00 + (p10 - p00) * fx;
			const bot = p01 + (p11 - p01) * fx;
			out[(y * S + x) * 4 + k] = Math.round(top + (bot - top) * fy);
		}
	}
}
fs.writeFileSync(outFile, encodePng(S, S, out));
console.log(`已把 ${src.w}x${src.h} 放大到 ${S}x${S}: ${outFile}`);
