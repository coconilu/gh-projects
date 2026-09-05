import { marked } from "marked";
import { useEffect, useState } from "react";
import * as api from "../api";
import { findCheckout, useStore } from "../store";
import type { FilePreview as Preview } from "../types";

export default function FilePreview({
	fkey,
	co,
}: {
	fkey: string;
	co: string;
}) {
	const { projects, toast } = useStore();
	const [pv, setPv] = useState<Preview | null>(null);
	const hit = findCheckout(projects, co);
	const rel = fkey.slice(co.length + 1);
	const fname = rel.split("/").pop() ?? rel;
	const abs = hit ? `${hit.c.path}/${rel}` : null;

	// biome-ignore lint/correctness/useExhaustiveDependencies: abs 由 fkey/co 派生，文件切换时重新加载即可
	useEffect(() => {
		setPv(null);
		if (!abs) return;
		api
			.readFilePreview(abs)
			.then(setPv)
			.catch((e) => toast(`读取文件失败: ${e}`));
	}, [fkey, co]);

	if (!hit) return <div className="content">checkout 不存在</div>;
	const isMd = fname.toLowerCase().endsWith(".md");

	return (
		<div className="content">
			<div className="crumb">
				{hit.c.branch} / <b>{rel}</b>
			</div>
			<div className="preview-head">
				📄 {fname}{" "}
				<span style={{ color: "var(--faint)" }}>
					· 双击文件树可用编辑器打开
				</span>
				<span style={{ flex: 1 }} />
				<button
					className="btn sm"
					onClick={() =>
						abs && api.openInEditor(abs).catch((e) => toast(`${e}`))
					}
				>
					在编辑器打开
				</button>
			</div>
			{!pv && <div className="hint">加载中…</div>}
			{pv?.isBinary && <div className="hint">二进制文件，无法预览</div>}
			{pv && !pv.isBinary && isMd && (
				<div
					className="card md"
					// biome-ignore lint/security/noDangerouslySetInnerHtml: 本地 Markdown 文件预览，内容由 marked 生成
					dangerouslySetInnerHTML={{ __html: marked.parse(pv.text) as string }}
				/>
			)}
			{pv && !pv.isBinary && !isMd && (
				<>
					<pre className="code">{pv.text}</pre>
					{pv.truncated && <div className="hint">（内容过长，已截断）</div>}
				</>
			)}
		</div>
	);
}
