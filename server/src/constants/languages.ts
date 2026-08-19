export type SupportedLanguage = "javascript" | "python" | "cpp";

export interface LanguageConfig {
  id: SupportedLanguage;
  label: string;
  starter: string;
}

export const LANGUAGE_CONFIG: Record<SupportedLanguage, LanguageConfig> = {
  javascript: {
    id: "javascript",
    label: "JavaScript",
    starter: `function main() {

}

main();
`
  },
  python: {
    id: "python",
    label: "Python",
    starter: `def main():
    pass

if __name__ == "__main__":
    main()
`
  },
  cpp: {
    id: "cpp",
    label: "C++",
    starter: `#include <iostream>

int main() {

    return 0;
}
`
  }
};

export const supportedLanguages = Object.keys(LANGUAGE_CONFIG) as SupportedLanguage[];
