import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";

/** Opens the system date dialog. Resolves to the picked day, or null when dismissed. */
export function pickDate(value: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value,
      mode: "date",
      onValueChange: (_e, d) => resolve(d),
      onDismiss: () => resolve(null),
      onError: () => resolve(null),
    });
  });
}

/** Opens the system time dialog. Resolves to `value` with the picked hour and minute, or null when dismissed. */
export function pickTime(value: Date): Promise<Date | null> {
  return new Promise((resolve) => {
    DateTimePickerAndroid.open({
      value,
      mode: "time",
      onValueChange: (_e, d) => resolve(d),
      onDismiss: () => resolve(null),
      onError: () => resolve(null),
    });
  });
}
