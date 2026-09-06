import { useEffect, useRef, useState } from "react";
import { type DialogState, useStore } from "../store";

export function Toast() {
	const msg = useStore((s) => s.toastMsg);
	return (
		<div
			className={"toast" + (msg ? " show" : "")}
			role="status"
			aria-live="polite"
		>
			{msg}
		</div>
	);
}
export function Dialog() {
	const dialog = useStore((s) => s.dialog);
	return dialog ? <DialogContent key={dialog.title} dialog={dialog} /> : null;
}
function DialogContent({ dialog }: { dialog: DialogState }) {
	const ref = useRef<HTMLDialogElement>(null);
	const busyRef = useRef(false);
	const [value, setValue] = useState(dialog.defaultValue ?? "");
	const [values, setValues] = useState<Record<string, string>>(
		Object.fromEntries(
			dialog.fields?.map((f) => [f.name, f.defaultValue ?? ""]) ?? [],
		),
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const close = useStore((s) => s.closeDialog);
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		const modal = ref.current!;
		modal.showModal();
		const first = modal.querySelector<HTMLElement>(
			dialog.danger ? ".cancel-btn" : "input, select, textarea, .cancel-btn",
		);
		first?.focus();
		return () => {
			modal.close();
			if (previous?.isConnected && previous.getClientRects().length)
				previous.focus();
			else
				document
					.querySelector<HTMLElement>('main .tab[aria-current="page"]')
					?.focus();
		};
	}, [dialog.danger]);
	const execute = async (secondary = false) => {
		if (busyRef.current) return;
		const validation = !secondary && dialog.validate?.(value, values);
		if (validation) {
			setError(validation);
			return;
		}
		busyRef.current = true;
		setBusy(true);
		setError("");
		try {
			if (secondary) await dialog.onSecondary?.();
			else await dialog.onSubmit(value, values);
			// 回调可能打开下一步对话框，不能把新对话框关掉。
			if (useStore.getState().dialog === dialog) close();
		} catch (e) {
			setError(String(e));
		} finally {
			busyRef.current = false;
			setBusy(false);
		}
	};
	return (
		<dialog
			ref={ref}
			className="dialog"
			aria-labelledby="dialog-title"
			aria-describedby="dialog-message"
			onKeyDown={(e) => {
				if (e.key !== "Tab") return;
				const targets = Array.from(
					e.currentTarget.querySelectorAll<HTMLElement>(
						'input:not(:disabled), select:not(:disabled), textarea:not(:disabled), button:not(:disabled), a[href], [tabindex="0"]',
					),
				).filter((element) => element.getClientRects().length > 0);
				const first = targets[0];
				const last = targets[targets.length - 1];
				if (!first) {
					e.preventDefault();
					e.currentTarget.focus();
				} else if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}}
			onCancel={(e) => {
				e.preventDefault();
				if (!busyRef.current) close();
			}}
		>
			<form
				onSubmit={(e) => {
					e.preventDefault();
					void execute();
				}}
			>
				<h3 id="dialog-title">{dialog.title}</h3>
				<div id="dialog-message" className="msg">
					{dialog.message}
				</div>
				{dialog.kind === "prompt" && !dialog.fields && (
					<label className="field">
						<span>{dialog.placeholder ?? "输入内容"}</span>
						<input
							className="input"
							required
							value={value}
							disabled={busy}
							placeholder={dialog.placeholder}
							onChange={(e) => setValue(e.target.value)}
						/>
					</label>
				)}
				{dialog.fields?.map((f) => (
					<label className="field" key={f.name}>
						<span>
							{f.label}
							{f.required ? " *" : ""}
						</span>
						{f.type === "select" ? (
							<select
								className="input"
								value={values[f.name]}
								disabled={busy}
								required={f.required}
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
							>
								{!f.defaultValue && <option value="">请选择</option>}
								{f.options?.map((o) => (
									<option key={o} value={o}>
										{o}
									</option>
								))}
							</select>
						) : f.type === "textarea" ? (
							<textarea
								className="input"
								value={values[f.name]}
								disabled={busy}
								required={f.required}
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
							/>
						) : (
							<input
								className="input"
								type={f.type ?? "text"}
								value={values[f.name]}
								disabled={busy}
								required={f.required}
								onChange={(e) =>
									setValues((v) => ({ ...v, [f.name]: e.target.value }))
								}
							/>
						)}
						{f.help && <small>{f.help}</small>}
					</label>
				))}
				{dialog.describe && (
					<div className="operation-preview">
						{dialog.describe(value, values)}
					</div>
				)}
				{error && (
					<div className="inline-error" role="alert">
						{error}
					</div>
				)}
				<div className="ops">
					<button
						type="button"
						className="btn cancel-btn"
						disabled={busy}
						onClick={close}
					>
						取消
					</button>
					{dialog.secondaryText && (
						<button
							type="button"
							className="btn"
							disabled={busy}
							onClick={() => void execute(true)}
						>
							{dialog.secondaryText}
						</button>
					)}
					<button
						type="submit"
						className={"btn " + (dialog.danger ? "danger" : "primary")}
						disabled={busy}
					>
						{busy
							? "处理中…"
							: (dialog.okText ??
								(dialog.kind === "confirm" ? "确认操作" : "保存"))}
					</button>
				</div>
			</form>
		</dialog>
	);
}
