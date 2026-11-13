import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { NumericTransformer } from '../../../common/utils/numeric-transformer';
import { User } from '../../users/entities/user.entity';
import { VenuePhoto } from './venue-photo.entity';
import { VenueFeatureAssignment } from './venue-feature-assignment.entity';
import { VenueTag } from './venue-tag.entity';
import { VenueTypeAssignment } from './venue-type-assignment.entity';

export enum VenueStatus {
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
  Archived = 'archived',
}

/** Дозволені переходи життєвого циклу закладу. Archived — термінальний
 *  стан: з нього не виходять, повторні апрув/reject/видалення неможливі. */
export const VENUE_TRANSITIONS: Partial<Record<VenueStatus, VenueStatus[]>> = {
  [VenueStatus.Pending]: [
    VenueStatus.Approved,
    VenueStatus.Rejected,
    VenueStatus.Archived,
  ],
  [VenueStatus.Rejected]: [VenueStatus.Approved, VenueStatus.Archived],
  [VenueStatus.Approved]: [VenueStatus.Archived],
};

export function canTransitionVenue(
  from: VenueStatus,
  to: VenueStatus,
): boolean {
  return VENUE_TRANSITIONS[from]?.includes(to) ?? false;
}

@Entity('venues')
@Index(['status'])
export class Venue {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') ownerId: string;
  @Column({ type: 'varchar', length: 200 }) name: string;
  @Column({ type: 'text', nullable: true }) description: string | null;
  @Column({ type: 'text' }) address: string;
  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: NumericTransformer,
  })
  latitude: number | null;
  @Column({
    type: 'decimal',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: NumericTransformer,
  })
  longitude: number | null;
  @Column({ type: 'jsonb', default: {} }) contacts: {
    phone?: string;
    instagram?: string;
    facebook?: string;
    website?: string;
  };
  @Column({ type: 'jsonb', default: {} }) workingHours: Record<string, string>;
  @Column({
    type: 'numeric',
    precision: 10,
    scale: 2,
    nullable: true,
    transformer: NumericTransformer,
  })
  averageCheck: number | null;
  @Column({ type: 'text', nullable: true }) mainPhotoUrl: string | null;
  @Column({ type: 'varchar', length: 16, default: VenueStatus.Pending })
  status: VenueStatus;
  @Column({
    type: 'numeric',
    precision: 3,
    scale: 2,
    default: 0,
    transformer: NumericTransformer,
  })
  ratingAvg: number;
  @Column({ type: 'integer', default: 0 }) ratingCount: number;
  @Column({ type: 'integer', default: 0 }) viewCount: number;
  /** Рекомендація критика: 1 критик на заклад, null — не рекомендований. */
  @Column({ type: 'uuid', nullable: true })
  recommendedBy: string | null;
  @Column({ type: 'timestamptz', nullable: true }) recommendedAt: Date | null;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ownerId' })
  owner: User;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'recommendedBy' })
  recommender: User | null;

  @OneToMany(() => VenuePhoto, (photo) => photo.venue)
  photos: VenuePhoto[];

  @OneToMany(() => VenueFeatureAssignment, (fa) => fa.venue)
  featureAssignments: VenueFeatureAssignment[];

  @OneToMany(() => VenueTag, (vt) => vt.venue)
  venueTags: VenueTag[];

  @OneToMany(() => VenueTypeAssignment, (vta) => vta.venue)
  venueTypeAssignments: VenueTypeAssignment[];
}
