declare const _default: {
    content: string[];
    theme: {
        extend: {
            fontFamily: {
                display: [string, string, string];
                mono: [string, string, string];
            };
            colors: {
                surface: {
                    900: string;
                    800: string;
                    700: string;
                    600: string;
                };
            };
            boxShadow: {
                panel: string;
            };
            animation: {
                float: string;
                fade: string;
            };
            keyframes: {
                float: {
                    "0%, 100%": {
                        transform: string;
                    };
                    "50%": {
                        transform: string;
                    };
                };
                fade: {
                    "0%": {
                        opacity: string;
                        transform: string;
                    };
                    "100%": {
                        opacity: string;
                        transform: string;
                    };
                };
            };
        };
    };
    plugins: any[];
};
export default _default;
