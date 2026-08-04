import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
  UseGuards,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiExcludeEndpoint,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { SimulateMessageDto } from './dto/simulate-message.dto';

/**
 * WhatsAppController
 *
 * Handles:
 * 1. GET /webhook — Meta verification handshake
 * 2. POST /webhook — Incoming messages from Meta (or mock simulator)
 * 3. POST /simulator/send — Dashboard mock: simulate customer message
 * 4. GET /simulator/messages — Dashboard mock: get sent messages list
 */
@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Meta webhook verification handshake.
   * Meta calls this when you register the webhook URL.
   */
  @Get('webhook')
  // @SkipThrottle() with no argument defaults to { default: true } in
  // @nestjs/throttler 6.x — it skips a throttler NAMED "default". This app's
  // throttlers are named "short" and "long" (app.module.ts), so the bare form
  // skipped nothing and these routes were rate limited at 10 req/s after all.
  // Named explicitly so the exemption actually applies.
  // Meta delivers webhooks in bursts; throttling them drops real customer messages.
  @SkipThrottle({ short: true, long: true })
  @ApiExcludeEndpoint()
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') verifyToken: string,
  ): string {
    const expectedToken = this.configService.get<string>(
      'WHATSAPP_VERIFY_TOKEN',
    );

    if (mode === 'subscribe' && verifyToken === expectedToken) {
      this.logger.log('WhatsApp webhook verified successfully');
      return challenge;
    }

    throw new BadRequestException('Webhook verification failed');
  }

  /**
   * Receives incoming WhatsApp messages from Meta Cloud API.
   * Always returns 200 immediately — processing is async via BullMQ.
   */
  @Post('webhook')
  @SkipThrottle({ short: true, long: true })
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receiveMessage(
    @Body() payload: Record<string, unknown>,
    @Headers('x-hub-signature-256') signature: string,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ status: string }> {
    // req.rawBody carries the exact bytes Meta signed; the parsed `payload`
    // cannot be used for HMAC verification (see verifyWebhookSignature).
    await this.whatsappService.handleIncomingWebhook(
      payload,
      signature,
      req.rawBody,
    );
    return { status: 'received' };
  }

  /**
   * Simulator: Simulate a customer WhatsApp message.
   * Used by the dashboard when WHATSAPP_PROVIDER=mock.
   * Requires authentication (dashboard users only).
   */
  @Post('simulator/send')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Simulate a customer sending a WhatsApp message (Mock Provider only)',
  })
  async simulateMessage(
    @CurrentTenant() tenantId: string,
    @Body() body: SimulateMessageDto,
  ) {
    const result = await this.whatsappService.simulateIncomingMessage(
      tenantId,
      body.phone,
      body.message,
    );
    return {
      success: true,
      message: 'Simulated message processed',
      data: result,
    };
  }

  /**
   * Simulator: Get list of outbound messages sent by the system.
   * Used by the dashboard to display the chat UI.
   */
  @Get('simulator/messages')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get recent simulated WhatsApp messages (Mock Provider only)',
  })
  async getSimulatorMessages(@CurrentTenant() tenantId: string) {
    const messages = await this.whatsappService.getSimulatorMessages(tenantId);
    return { success: true, data: messages };
  }
}
