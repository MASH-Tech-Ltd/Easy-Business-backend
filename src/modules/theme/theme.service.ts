import { Theme } from './theme.model';
import { ITheme } from './theme.model';

const updateTheme = async (tenantId: string, payload: Partial<ITheme>) => {
  const result = await Theme.findOneAndUpdate(
    { tenantId },
    { ...payload },
    { returnDocument: 'after', upsert: true }
  );
  return result;
};

const getTheme = async (tenantId: string) => {
  let result = await Theme.findOne({ tenantId });
  if (!result) {
    result = await Theme.create({ tenantId });
  }
  return result;
};

export const ThemeService = {
  updateTheme,
  getTheme,
};
