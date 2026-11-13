import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Мʼяке видалення відгуків: колонка deletedAt.
 * `reviews_venueId_userId_key` (UNIQUE("venueId","userId")) перетворюється
 * на частковий індекс з `WHERE "deletedAt" IS NULL` — автор після видалення
 * відгуку може залишити новий на той самий заклад. Констрейнт знімається
 * за фактичним імʼям з pg_constraint, щоб не залежати від варіантів
 * неймінгу між середовищами.
 */
export class ReviewSoftDelete1700000014000 implements MigrationInterface {
  name = 'ReviewSoftDelete1700000014000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "reviews" ADD COLUMN "deletedAt" timestamptz`);
    await q.query(`
      DO $$
      DECLARE
        c text;
      BEGIN
        SELECT conname INTO c
        FROM pg_constraint
        WHERE conrelid = 'reviews'::regclass AND contype = 'u'
        LIMIT 1;
        IF c IS NOT NULL THEN
          EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', 'reviews', c);
        END IF;
      END $$;
    `);
    await q.query(`
      CREATE UNIQUE INDEX "reviews_venue_user_active"
      ON "reviews"("venueId", "userId")
      WHERE "deletedAt" IS NULL
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "reviews_venue_user_active"`);
    // Помʼякшені відгуки вдаляються фізично: з ними унік-констрейнт
    // неможливо відновити, а читачі їх уже й не бачать.
    await q.query(`DELETE FROM "reviews" WHERE "deletedAt" IS NOT NULL`);
    await q.query(`ALTER TABLE "reviews" DROP COLUMN "deletedAt"`);
    await q.query(
      `ALTER TABLE "reviews" ADD CONSTRAINT "reviews_venueId_userId_key" UNIQUE ("venueId", "userId")`,
    );
  }
}
