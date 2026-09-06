import { useEffect, useRef, useState } from "react";

export function useResource<T>(key: string, load: () => Promise<T>) {
	const loader = useRef(load);
	loader.current = load;
	const [revision, setRevision] = useState(0);
	const [state, setState] = useState<{
		key: string;
		data: T | null;
		error: string;
		loading: boolean;
	}>({
		key,
		data: null,
		error: "",
		loading: true,
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: revision 是显式重试信号
	useEffect(() => {
		let cancelled = false;
		setState({ key, data: null, error: "", loading: true });
		Promise.resolve()
			.then(() => loader.current())
			.then(
				(data) => {
					if (!cancelled) setState({ key, data, error: "", loading: false });
				},
				(error) => {
					if (!cancelled)
						setState({ key, data: null, error: String(error), loading: false });
				},
			);
		return () => {
			cancelled = true;
		};
	}, [key, revision]);
	return {
		...(state.key === key ? state : { data: null, error: "", loading: true }),
		reload: () => setRevision((n) => n + 1),
	};
}

export function ResourceState({
	loading,
	error,
	title = "暂无内容",
	detail,
	onRetry,
	action,
}: {
	loading?: boolean;
	error?: string;
	title?: string;
	detail?: string;
	onRetry?: () => void;
	action?: React.ReactNode;
}) {
	const errorTitle = /rate limit|429/i.test(error ?? "")
		? "请求受限，请稍后重试"
		: /401|未登录|bad credentials/i.test(error ?? "")
			? "登录状态已失效"
			: /403|forbidden/i.test(error ?? "")
				? "访问被拒绝，请检查仓库权限"
				: "加载失败";
	return (
		<div
			className={"resource-state" + (error ? " has-error" : "")}
			role={error ? "alert" : "status"}
		>
			<strong>{loading ? "正在加载…" : error ? errorTitle : title}</strong>
			{(error || detail) && <p>{error || detail}</p>}
			{error && onRetry && (
				<button className="btn" onClick={onRetry}>
					重试
				</button>
			)}
			{!loading && !error && action}
		</div>
	);
}
