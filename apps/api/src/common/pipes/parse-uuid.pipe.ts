import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { isUUID } from 'class-validator';

const MESSAGE = 'Некоректний ідентифікатор';

/**
 * Валідує формат універсального ідентифікатора ще на контролері:
 * невалідне значення не має доїжджати до запиту в базу.
 * Версію приймаємо будь-яку — як і IsUUID('all') у DTO.
 */
@Injectable()
export class ParseUuidPipe implements PipeTransform {
  transform(value: string): string {
    if (!isUUID(value, 'all')) {
      throw new BadRequestException(MESSAGE);
    }
    return value;
  }
}
