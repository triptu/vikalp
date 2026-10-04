export function relativeTime(timestamp: number, now: number): string {
	const seconds = Math.round((now - timestamp) / 1000);
	if (seconds < 45) return "just now";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days < 30) return `${days} d ago`;
	return new Date(timestamp).toLocaleDateString();
}

export function formatCost(dollars: number): string {
	if (dollars === 0) return "$0.00";
	if (dollars < 0.01) return "<$0.01";
	return `$${dollars.toFixed(2)}`;
}

export function percentChange(before: number, after: number): string {
	if (before === 0) return "0%";
	const change = Math.round(((after - before) / before) * 100);
	return `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)}%`;
}
