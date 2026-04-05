export const formatTimestamp = (value: number) =>
  new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(value);

export const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

