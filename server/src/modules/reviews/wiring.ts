/**
 * COMPOSITION — the reviews module's smart-diff composition root. The shared
 * review repository implements the service's port (rows mapped to domain
 * inputs inside it).
 */
import type { Container } from '../../platform/container.js';
import { SmartDiffService } from './smart-diff.service.js';

export function buildSmartDiffService(container: Container): SmartDiffService {
  return new SmartDiffService(container.reviewRepo);
}
