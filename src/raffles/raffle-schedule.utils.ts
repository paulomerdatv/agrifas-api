import { RaffleStatus } from '@prisma/client';

interface RaffleScheduleLike {
  status: RaffleStatus;
  publishAt?: Date | string | null;
  endAt?: Date | string | null;
}

const toDate = (value?: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

export const normalizeRaffleScheduleDates = (raffle: RaffleScheduleLike) => {
  return {
    publishAt: toDate(raffle.publishAt),
    endAt: toDate(raffle.endAt),
  };
};

export const isRaffleActiveInScheduleWindow = (
  raffle: RaffleScheduleLike,
  now: Date = new Date(),
) => {
  if (raffle.status !== RaffleStatus.ACTIVE) {
    return false;
  }

  const { publishAt, endAt } = normalizeRaffleScheduleDates(raffle);

  if (publishAt && now.getTime() < publishAt.getTime()) {
    return false;
  }

  if (endAt && now.getTime() >= endAt.getTime()) {
    return false;
  }

  return true;
};

export const getRaffleUnavailableReason = (
  raffle: RaffleScheduleLike,
  now: Date = new Date(),
) => {
  if (raffle.status !== RaffleStatus.ACTIVE) {
    if (raffle.status === RaffleStatus.DRAFT) {
      return 'Rifa em rascunho.';
    }
    if (raffle.status === RaffleStatus.PAUSED) {
      return 'Rifa pausada.';
    }
    if (raffle.status === RaffleStatus.ENDED) {
      return 'Rifa encerrada.';
    }
    if (raffle.status === RaffleStatus.CANCELLED) {
      return 'Rifa cancelada.';
    }
    return 'Rifa indisponivel.';
  }

  const { publishAt, endAt } = normalizeRaffleScheduleDates(raffle);

  if (publishAt && now.getTime() < publishAt.getTime()) {
    return 'Rifa ainda nao foi publicada.';
  }

  if (endAt && now.getTime() >= endAt.getTime()) {
    return 'Rifa encerrada pelo agendamento.';
  }

  return null;
};

export const deriveAdminRaffleTimelineStatus = (
  raffle: RaffleScheduleLike,
  now: Date = new Date(),
): 'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'DRAFT' | 'PAUSED' | 'CANCELLED' => {
  if (raffle.status === RaffleStatus.DRAFT) {
    return 'DRAFT';
  }

  if (raffle.status === RaffleStatus.PAUSED) {
    return 'PAUSED';
  }

  if (raffle.status === RaffleStatus.CANCELLED) {
    return 'CANCELLED';
  }

  if (raffle.status === RaffleStatus.ENDED) {
    return 'ENDED';
  }

  const { publishAt, endAt } = normalizeRaffleScheduleDates(raffle);

  if (publishAt && now.getTime() < publishAt.getTime()) {
    return 'SCHEDULED';
  }

  if (endAt && now.getTime() >= endAt.getTime()) {
    return 'ENDED';
  }

  return 'ACTIVE';
};
