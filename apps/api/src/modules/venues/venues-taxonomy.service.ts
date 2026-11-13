import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { VenueFeature } from './entities/venue-feature.entity';
import { VenueFeatureAssignment } from './entities/venue-feature-assignment.entity';
import { Tag } from './entities/tag.entity';
import { VenueTag } from './entities/venue-tag.entity';
import { VenueType } from './entities/venue-type.entity';
import { VenueTypeAssignment } from './entities/venue-type-assignment.entity';

/**
 * Властивості закладу «довідник → прив'язка»: типи, особливості, теги.
 *
 * Тут живе все, що стосується чотирьох пар «довідник/assignment»: читання
 * довідників для фільтрів каталогу, валідація наборів перед записом
 * (невідомий код/слаг — 400, щоб не лишати заклад напівзаповненим) і
 * повна заміна прив'язок (набірні поля перезаписуються заново).
 */
@Injectable()
export class VenueTaxonomyService {
  constructor(
    @InjectRepository(VenueFeature)
    private readonly features: Repository<VenueFeature>,
    @InjectRepository(VenueFeatureAssignment)
    private readonly featureAssignments: Repository<VenueFeatureAssignment>,
    @InjectRepository(Tag) private readonly tags: Repository<Tag>,
    @InjectRepository(VenueTag)
    private readonly venueTags: Repository<VenueTag>,
    @InjectRepository(VenueType)
    private readonly venueTypes: Repository<VenueType>,
    @InjectRepository(VenueTypeAssignment)
    private readonly venueTypeAssignments: Repository<VenueTypeAssignment>,
  ) {}

  /** Довідник типів закладів (для select-фільтра каталогу). */
  listTypes(): Promise<VenueType[]> {
    return this.venueTypes.find({ order: { name: 'ASC' } });
  }

  /** Довідник особливостей (для чип-фільтра каталогу). */
  listFeatures(): Promise<VenueFeature[]> {
    return this.features.find({ order: { name: 'ASC' } });
  }

  /** Довідник тегів: тег + кількість закладів, де він використаний. */
  async listTags(): Promise<
    { id: string; name: string; slug: string; venueCount: number }[]
  > {
    return this.tags
      .createQueryBuilder('t')
      .select('t.id', 'id')
      .addSelect('t.name', 'name')
      .addSelect('t.slug', 'slug')
      .addSelect('COUNT(vt."venueId")::int', 'venueCount')
      .leftJoin(VenueTag, 'vt', 'vt."tagId" = t."id"')
      .groupBy('t.id')
      .orderBy('venueCount', 'DESC')
      .addOrderBy('t.name', 'ASC')
      .getRawMany<{
        id: string;
        name: string;
        slug: string;
        venueCount: number;
      }>();
  }

  /** Валідація наборів до запису: невідомий код/слаг — 400. */
  async resolveFeatures(codes: string[]): Promise<VenueFeature[]> {
    const unique = [...new Set(codes)];
    const features = unique.length
      ? await this.features.find({ where: { code: In(unique) } })
      : [];
    const unknown = unique.filter((c) => !features.some((f) => f.code === c));
    if (unknown.length)
      throw new BadRequestException(
        `Невідомі особливості: ${unknown.join(', ')}`,
      );
    return features;
  }

  async resolveTags(slugs: string[]): Promise<Tag[]> {
    const unique = [...new Set(slugs)];
    const tags = unique.length
      ? await this.tags.find({ where: { slug: In(unique) } })
      : [];
    const unknown = unique.filter((s) => !tags.some((t) => t.slug === s));
    if (unknown.length)
      throw new BadRequestException(`Невідомі теги: ${unknown.join(', ')}`);
    return tags;
  }

  /** Порожній/null-slug = зняти тип (null); невідомий слаг — 400. */
  async resolveType(typeSlug?: string | null): Promise<VenueType | null> {
    const slug = typeSlug?.trim();
    if (!slug) return null;
    const type = await this.venueTypes.findOne({ where: { slug } });
    if (!type)
      throw new BadRequestException(`Невідомий тип закладу: «${slug}»`);
    return type;
  }

  async writeFeatures(
    venueId: string,
    features: VenueFeature[],
  ): Promise<void> {
    await this.featureAssignments.delete({ venueId });
    if (features.length)
      await this.featureAssignments.save(
        features.map((f) => ({ venueId, featureId: f.id })),
      );
  }

  async writeTags(venueId: string, tags: Tag[]): Promise<void> {
    await this.venueTags.delete({ venueId });
    if (tags.length)
      await this.venueTags.save(tags.map((t) => ({ venueId, tagId: t.id })));
  }

  async writeType(venueId: string, type: VenueType | null): Promise<void> {
    await this.venueTypeAssignments.delete({ venueId });
    if (type)
      await this.venueTypeAssignments.save({ venueId, typeId: type.id });
  }
}
