import {
  BadRequestException,
  Body,
  CanActivate,
  ConflictException,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Module,
  Post,
  Put,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import bcrypt from 'bcryptjs';
import type { Request, Response } from 'express';
import { DataSource } from 'typeorm';
import { AppUser, UserSettings } from '../db/entities';
import { IS_PUBLIC, Public, isIsoDate } from '../common/util';

export const COOKIE = 'gw_token';
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export type Settings = UserSettings;
export const DEFAULT_SETTINGS: Settings = { codeA: 'K', codeB: 'N', startDate: '2026-11-16', font: 'Caveat' };

class CredentialsDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Matches(/^[a-zA-Z0-9_.-]+$/, { message: 'username: letters, numbers, _ . - only' })
  username: string;

  @IsString() @MinLength(8) @MaxLength(200) password: string;
}

class ChangePasswordDto {
  @IsString() current: string;
  @IsString() @MinLength(8) @MaxLength(200) next: string;
}

class SettingsDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2) codeA?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2) codeB?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() @MaxLength(40) @Matches(/^[A-Za-z0-9 ]+$/) font?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(300) @IsInt({ each: true }) @Min(2000, { each: true }) @Max(2200, { each: true }) books?: number[];
}

interface TokenPayload {
  sub: string;
  username: string;
}

@Injectable()
export class AuthService {
  private dummyHash?: string;

  constructor(
    private readonly ds: DataSource,
    private readonly jwt: JwtService,
  ) {}

  private get users() {
    return this.ds.getRepository(AppUser);
  }

  async hasUser(): Promise<boolean> {
    return (await this.users.count()) > 0;
  }

  /** Creates the one and only account. Fails once an account exists. */
  async setup(dto: CredentialsDto): Promise<string> {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.ds.transaction(async (m) => {
      await m.query('SELECT pg_advisory_xact_lock(424242)'); // serialise concurrent setups
      if ((await m.count(AppUser)) > 0) throw new ConflictException('An account already exists. Log in instead.');
      return m.save(m.create(AppUser, { username: dto.username, passwordHash, settings: DEFAULT_SETTINGS }));
    });
    return this.sign(user.id, user.username);
  }

  async login(dto: CredentialsDto): Promise<string> {
    const user = await this.users.findOneBy({ username: dto.username });
    // Compare against a dummy hash for unknown users so response time does not reveal usernames.
    this.dummyHash ??= await bcrypt.hash('not-a-real-password', 12);
    const ok = await bcrypt.compare(dto.password, user?.passwordHash ?? this.dummyHash);
    if (!user || !ok) throw new UnauthorizedException('Wrong username or password');
    return this.sign(user.id, user.username);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const user = await this.users.findOneBy({ id: userId });
    if (!user || !(await bcrypt.compare(dto.current, user.passwordHash))) {
      throw new UnauthorizedException('Current password is wrong');
    }
    user.passwordHash = await bcrypt.hash(dto.next, 12);
    await this.users.save(user);
  }

  async verify(token: string | undefined): Promise<TokenPayload | null> {
    if (!token) return null;
    try {
      return await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      return null;
    }
  }

  async getSettings(): Promise<Settings> {
    const [user] = await this.users.find({ take: 1 });
    return { ...DEFAULT_SETTINGS, ...(user?.settings ?? {}) };
  }

  async updateSettings(dto: SettingsDto): Promise<Settings> {
    if (dto.startDate !== undefined && !isIsoDate(dto.startDate)) throw new BadRequestException('startDate must be YYYY-MM-DD');
    const [user] = await this.users.find({ take: 1 });
    if (!user) throw new BadRequestException('No account yet');
    const next: Settings = { ...DEFAULT_SETTINGS, ...user.settings };
    if (dto.codeA) next.codeA = dto.codeA.toUpperCase();
    if (dto.codeB) next.codeB = dto.codeB.toUpperCase();
    if (dto.startDate) next.startDate = dto.startDate;
    if (dto.font) next.font = dto.font;
    if (dto.books) next.books = [...new Set(dto.books)].sort((a, b) => a - b);
    user.settings = next;
    await this.users.save(user);
    return next;
  }

  private sign(id: string, username: string): Promise<string> {
    return this.jwt.signAsync({ sub: id, username } satisfies TokenPayload);
  }
}

/** Global guard: every route needs a valid cookie unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: TokenPayload }>();
    const payload = await this.auth.verify(req.cookies?.[COOKIE]);
    if (!payload) throw new UnauthorizedException('Please log in');
    req.user = payload;
    return true;
  }
}

function setCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: THIRTY_DAYS,
    path: '/',
  });
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('status')
  async status(@Req() req: Request) {
    const payload = await this.auth.verify(req.cookies?.[COOKIE]);
    return { hasUser: await this.auth.hasUser(), authenticated: !!payload, username: payload?.username ?? null };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Post('setup')
  async setup(@Body() dto: CredentialsDto, @Res({ passthrough: true }) res: Response) {
    setCookie(res, await this.auth.setup(dto));
    return { ok: true };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  @Post('login')
  async login(@Body() dto: CredentialsDto, @Res({ passthrough: true }) res: Response) {
    setCookie(res, await this.auth.login(dto));
    return { ok: true };
  }

  @Public()
  @HttpCode(200)
  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  }

  @HttpCode(200)
  @Post('password')
  async password(@Req() req: Request & { user: TokenPayload }, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(req.user.sub, dto);
    return { ok: true };
  }
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly auth: AuthService) {}

  @Get()
  get() {
    return this.auth.getSettings();
  }

  @Put()
  put(@Body() dto: SettingsDto) {
    return this.auth.updateSettings(dto);
  }
}

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET ?? '';
        if (secret.length < 32 || secret.startsWith('change-me')) {
          throw new Error('JWT_SECRET must be a random string of at least 32 characters (see .env.example)');
        }
        return { secret, signOptions: { expiresIn: '30d' } };
      },
    }),
  ],
  controllers: [AuthController, SettingsController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
})
export class AuthModule {}
