export default {
    content: ["./index.html", "./src/**/*.{ts,tsx}"],
    theme: {
        extend: {
            fontFamily: {
                display: ["Space Grotesk", "system-ui", "sans-serif"],
                mono: ["IBM Plex Mono", "ui-monospace", "monospace"]
            },
            colors: {
                surface: {
                    900: "#07111f",
                    800: "#0d1728",
                    700: "#132033",
                    600: "#1f2c43"
                }
            },
            boxShadow: {
                panel: "0 24px 60px rgba(3, 10, 24, 0.38)"
            },
            animation: {
                float: "float 7s ease-in-out infinite",
                fade: "fade 0.5s ease both"
            },
            keyframes: {
                float: {
                    "0%, 100%": { transform: "translateY(0px)" },
                    "50%": { transform: "translateY(-10px)" }
                },
                fade: {
                    "0%": { opacity: "0", transform: "translateY(12px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" }
                }
            }
        }
    },
    plugins: []
};
