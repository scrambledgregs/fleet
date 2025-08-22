export default {
  content: ["./index.html", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0f1115",
        panel: "#161b22",        // a touch darker than before for clearer separation
        accent: "#5cc8ff",       // cool blue instead of pink
        success: "#00e676",
        warning: "#ffab40",
      },
      boxShadow: {
        soft: "0 12px 32px rgba(0,0,0,0.45)", // slightly deeper than before
      },
    },
  },
  plugins: [],
}