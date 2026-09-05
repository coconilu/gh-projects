import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Tauri 期望固定端口与 devUrl
export default defineConfig({
	plugins: [react(), tailwindcss()],
	clearScreen: false,
	build: {
		// 图标 SVG 一律输出为独立 asset 文件，按需加载，不内联进 JS bundle
		assetsInlineLimit: (filePath) =>
			filePath.endsWith(".svg") ? false : undefined,
	},
	server: {
		port: 1420,
		strictPort: true,
		watch: { ignored: ["**/src-tauri/**"] },
	},
});
