// Пиячки зберігаються як стен-час «YYYY-MM-DD» + «HH:mm» за Києвом.
// Розбір цього стен-часу в момент часу має рахувати офсет за тими самими
// правилами IANA Europe/Kyiv, за якими Postgres рахує
// AT TIME ZONE 'Europe/Kyiv' у кроні завершення: взимку +2, улітку +3.
// Жорсткий офсет у JS дав би розбіжність із базою на годину половину року.
const KYIV = 'Europe/Kyiv';

const wallFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: KYIV,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

// Стен-час Kyiv-зони для моменту `at`, прочитаний як epoch, ніби це UTC
const wallEpoch = (at: Date): number => {
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    wallFmt.formatToParts(at).find((p) => p.type === type)?.value ?? '';
  return Date.parse(
    `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}Z`,
  );
};

export function kyivWallToUtc(date: string, time: string): Date {
  // Стартове припущення: стен-час, прочитаний як UTC.
  const guessEpoch = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(guessEpoch)) return new Date(NaN);
  // Офсет зони для цієї дати; другий прохід дає той самий офсет,
  // порахований уже в цільовому моменті (сходиться біля переходів годинника).
  let offset = wallEpoch(new Date(guessEpoch)) - guessEpoch;
  const near = guessEpoch - offset;
  offset = wallEpoch(new Date(near)) - near;
  return new Date(guessEpoch - offset);
}
