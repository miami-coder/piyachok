import { PartialType } from '@nestjs/mapped-types';
import { CreateNewsDto } from './create-news.dto';

/**
 * PATCH /news/:id — усі поля необовʼязкові.
 *
 * Довірене місце: контролери, що декларують тіло як Partial<CreateXxxDto>,
 * мають метатайп Object — глобальний ValidationPipe із whitelist пропускає
 * таке тіло НЕвалідованим, і воно потрапляє в Object.assign на сущність.
 * Клас із повним набором декораторів повертає валідацію і відсікання
 * сторонніх полів на межі HTTP.
 */
export class UpdateNewsDto extends PartialType(CreateNewsDto) {}
