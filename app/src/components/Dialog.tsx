import { useEffect, useState } from "react";
import { useStore } from "../store";

export function Toast() {
	const msg = useStore((s) => s.toastMsg);
	return <div className={`toast${msg ? " show" : ""}`}>{msg}</div>;
}

export function Dialog() {
	const { dialog, closeDialog } = useStore();
	const [v, setV] = useState("");
	useEffect(() => {
		setV(dialog?.defaultValue ?? "");
	}, [dialog]);
	if (!dialog) return null;
	const submit = () => dialog.onSubmit(v);
	return (
		<div className="dialog-mask" onClick={closeDialog}>
			<div className="dialog" onClick={(e) => e.stopPropagation()}>
				<h3>{dialog.title}</h3>
				{dialog.message && <div className="msg">{dialog.message}</div>}
				{dialog.kind === "prompt" && (
					<input
						className="input"
						// biome-ignore lint/a11y/noAutofocus: 模态输入框自动聚焦是预期交互
						autoFocus
						placeholder={dialog.placeholder}
						value={v}
						onChange={(e) => setV(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === "Enter") submit();
							if (e.key === "Escape") closeDialog();
						}}
					/>
				)}
				<div className="ops">
					<button className="btn" onClick={closeDialog}>
						取消
					</button>
					{dialog.secondaryText && (
						<button className="btn" onClick={() => dialog.onSecondary?.()}>
							{dialog.secondaryText}
						</button>
					)}
					<button
						className={`btn primary${dialog.danger ? " danger" : ""}`}
						style={
							dialog.danger
								? { background: "#9e2f2f", borderColor: "#b3413c" }
								: undefined
						}
						onClick={submit}
					>
						{dialog.okText ?? "确定"}
					</button>
				</div>
			</div>
		</div>
	);
}
