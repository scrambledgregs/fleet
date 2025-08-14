export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: { background:"#0f1115", panel:"#141820", accent:"#ff3366", success:"#00e676", warning:"#ffab40" },
      boxShadow: { soft:"0 10px 30px rgba(0,0,0,0.35)" }
    }
  }, plugins: []
}
