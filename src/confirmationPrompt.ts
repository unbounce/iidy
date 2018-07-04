import * as inquirer from 'inquirer';

export default async (message: string): Promise<boolean> => {
  const {confirmed} = await inquirer.prompt<{confirmed: boolean}>({
    name: 'confirmed',
    type: 'confirm', default: false,
    message
  });
  return confirmed;
}
