import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Favorite } from './entities/favorite.entity';
import { VenuesService } from '../venues/venues.service';
import {
  buildMeta,
  normalizePagination,
} from '../../common/utils/pagination.util';

@Injectable()
export class FavoritesService {
  constructor(
    @InjectRepository(Favorite)
    private readonly favorites: Repository<Favorite>,
    private readonly venuesService: VenuesService,
  ) {}

  async add(userId: string, venueId: string): Promise<void> {
    // Правило «заклад схвалений» — спільна перевірка venues.service.
    await this.venuesService.findByIdApprovedOrThrow(venueId);
    const existing = await this.favorites.findOne({
      where: { userId, venueId },
    });
    if (existing) return;
    await this.favorites.save({ userId, venueId });
  }

  async remove(userId: string, venueId: string): Promise<void> {
    await this.favorites.delete({ userId, venueId });
  }

  async list(userId: string, page = 1, limit = 20) {
    const { offset } = normalizePagination({ page, limit });
    const [favs, total] = await this.favorites.findAndCount({
      where: { userId },
      order: { createdAt: 'DESC' },
      skip: offset,
      take: limit,
    });
    const venueIds = favs.map((f) => f.venueId);
    // Дані закладу беремо тільки через venues.service — проекція картки
    // зберігає порядок вподобань, неіснуючі заклади відкидаються.
    const data = await this.venuesService.getCardsByIds(venueIds);
    return { data, meta: buildMeta({ page, limit, offset }, total) };
  }
}
