import { readFileSync, writeFileSync } from 'node:fs';

import type { Path } from '@affine-tools/utils/path';
import { type BuiltInParserName, format } from 'prettier';

import { Command } from './command';

export class CodegenCommand extends Command {
  static override paths = [['init'], ['i'], ['codegen']];

  async execute() {
    this.logger.info('Generating Workspace configs');
    await this.generateWorkspaceFiles();
    this.logger.info('Workspace configs generated');
  }

  async generateWorkspaceFiles() {
    const filesToGenerate: [Path, () => string, BuiltInParserName?][] = [
      [
        this.workspace.join('tsconfig.project.json'),
        this.workspace.genProjectTsConfig.bind(this.workspace),
        'json',
      ],
      [
        this.workspace
          .getPackage('@affine-tools/utils')
          .join('src/workspace.gen.ts'),
        this.workspace.genWorkspaceInfo.bind(this.workspace),
        'typescript',
      ],
      [this.workspace.join('oxlint.json'), this.genOxlintConfig, 'json'],
    ];

    for (const [path, content, formatter] of filesToGenerate) {
      this.logger.info(`Output: ${path}`);
      let file = content();
      if (formatter) {
        file = await this.format(file, formatter);
      }
      writeFileSync(path.value, file);
    }
  }

  format(content: string, parser: BuiltInParserName) {
    const config = JSON.parse(
      readFileSync(this.workspace.join('.prettierrc').value, 'utf-8')
    );
    return format(content, { parser, ...config });
  }

  genOxlintConfig = () => {
    const json = JSON.parse(
      readFileSync(this.workspace.join('oxlint.json').value, 'utf-8')
    );

    const ignoreList = readFileSync(
      this.workspace.join('.prettierignore').value,
      'utf-8'
    )
      .split('\n')
      .filter(line => line.trim() && !line.startsWith('#'));

    json['ignorePatterns'] = ignoreList;

    return JSON.stringify(json, null, 2);
  };
}
