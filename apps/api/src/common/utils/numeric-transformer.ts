import { ValueTransformer } from 'typeorm';

/** Драйвер pg числові типи numeric/decimal повертає рядками, хоча колонка
 *  в ентіті оголошена числом. Transformer на читанні приводить значення до
 *  числа (null лишається null), на записі — ідентичність: pg приймає
 *  число як є. Важливо: на getRawMany/getRawOne transformer не діє —
 *  агрегати в SQL приводяться вручну на місці. */
export const NumericTransformer: ValueTransformer = {
  to: (value: unknown) => value,
  from: (value: unknown) =>
    value === null || value === undefined ? null : Number(value),
};
