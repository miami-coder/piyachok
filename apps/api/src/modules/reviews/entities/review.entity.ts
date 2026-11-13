import {
  Column,
  CreateDateColumn,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Venue } from '../../venues/entities/venue.entity';
import { User } from '../../users/entities/user.entity';

@Entity('reviews')
// Унік пари (venueId, userId) тримає частковий індекс у міграції
// ReviewSoftDelete (тільки для не видалених відгуків), інакше автор
// після мʼякого видалення ніколи не зміг би залишити новий відгук.
@Index(['venueId', 'createdAt'])
export class Review {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column('uuid') venueId: string;
  @Column('uuid') userId: string;
  @Column({ type: 'smallint' }) rating: number;
  @Column({ type: 'text' }) text: string;
  @Column({ type: 'text', nullable: true }) checkPhotoUrl: string | null;
  /** Сума чека відвідувача, грн (опційно). */
  @Column({ type: 'integer', nullable: true }) billAmount: number | null;
  @Column({ type: 'boolean', default: false }) isFeatured: boolean;
  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
  @DeleteDateColumn({ name: 'deletedAt' }) deletedAt: Date | null;

  @ManyToOne(() => Venue, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'venueId' })
  venue: Venue;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;
}
