import { LiveData, Store } from '@toeverything/infra';
import { map } from 'rxjs';

import { AuthService, type WorkspaceServerService } from '../../cloud';
import type { WorkspaceDBService } from '../../db';
import type { WorkspaceService } from '../../workspace';
import type { FavoriteSupportTypeUnion } from '../constant';
import { isFavoriteSupportType } from '../constant';

export interface FavoriteRecord {
  type: FavoriteSupportTypeUnion;
  id: string;
  index: string;
}

export class FavoriteStore extends Store {
  authService = this.workspaceServerService.server?.scope.get(AuthService);
  constructor(
    private readonly workspaceDBService: WorkspaceDBService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceServerService: WorkspaceServerService
  ) {
    super();
  }

  private get userdataDB$() {
    // if is local workspace or no account, use __local__ userdata
    // sometimes we may have cloud workspace but no account for a short time, we also use __local__ userdata
    if (
      this.workspaceService.workspace.meta.flavour === 'local' ||
      !this.authService
    ) {
      return new LiveData(this.workspaceDBService.userdataDB('__local__'));
    } else {
      return this.authService.session.account$.map(account => {
        if (!account) {
          return this.workspaceDBService.userdataDB('__local__');
        }
        return this.workspaceDBService.userdataDB(account.id);
      });
    }
  }

  watchIsLoading() {
    return this.userdataDB$
      .map(db => LiveData.from(db.favorite.isLoading$, false))
      .flat();
  }

  watchFavorites() {
    return this.userdataDB$
      .map(db => LiveData.from(db.favorite.find$(), []))
      .flat()
      .map(raw => {
        return raw
          .map(data => this.toRecord(data))
          .filter((record): record is FavoriteRecord => !!record);
      });
  }

  addFavorite(
    type: FavoriteSupportTypeUnion,
    id: string,
    index: string
  ): FavoriteRecord {
    const db = this.userdataDB$.value;
    const raw = db.favorite.create({
      key: this.encodeKey(type, id),
      index,
    });
    return this.toRecord(raw) as FavoriteRecord;
  }

  reorderFavorite(type: FavoriteSupportTypeUnion, id: string, index: string) {
    const db = this.userdataDB$.value;
    db.favorite.update(this.encodeKey(type, id), { index });
  }

  removeFavorite(type: FavoriteSupportTypeUnion, id: string) {
    const db = this.userdataDB$.value;
    db.favorite.delete(this.encodeKey(type, id));
  }

  watchFavorite(type: FavoriteSupportTypeUnion, id: string) {
    const db = this.userdataDB$.value;
    return LiveData.from<FavoriteRecord | undefined>(
      db.favorite
        .get$(this.encodeKey(type, id))
        .pipe(map(data => (data ? this.toRecord(data) : undefined))),
      null as any
    );
  }

  private toRecord(data: {
    key: string;
    index: string;
  }): FavoriteRecord | undefined {
    const key = this.parseKey(data.key);
    if (!key) {
      return undefined;
    }
    return {
      type: key.type,
      id: key.id,
      index: data.index,
    };
  }

  /**
   * parse favorite key
   * key format: ${type}:${id}
   * type: collection | doc | tag
   * @returns null if key is invalid
   */
  private parseKey(key: string): {
    type: FavoriteSupportTypeUnion;
    id: string;
  } | null {
    const [type, id] = key.split(':');
    if (!type || !id) {
      return null;
    }
    if (!isFavoriteSupportType(type)) {
      return null;
    }
    return { type: type as FavoriteSupportTypeUnion, id };
  }

  private encodeKey(type: FavoriteSupportTypeUnion, id: string) {
    return `${type}:${id}`;
  }
}
