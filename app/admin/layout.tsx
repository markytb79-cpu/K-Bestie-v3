export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--hb-bg)" }}>
      <header
        style={{
          background: "var(--hb-card)",
          borderBottom: "1px solid var(--hb-border)",
          padding: "16px 24px",
        }}
      >
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#1e1e2d", margin: 0 }}>
          내친구 케이 — 관리자
        </h1>
      </header>
      <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px" }}>{children}</main>
    </div>
  );
}
