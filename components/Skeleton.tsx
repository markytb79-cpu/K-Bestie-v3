export function SkeletonBox({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-gray-200/70 ${className}`} />;
}
