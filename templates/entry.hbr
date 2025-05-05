import { CloudService } from './service';

class AppCloudService extends CloudService {
  protected override onRequest(request: Request): Response | Promise<Response> {
    // TODO: Implement your service logic here
    // For example, you can use the database and secrets like this:
    // const result = await this.database.query('SELECT * FROM users');
    // const secretValue = this.secrets.someSecret;
    // return new Response(`Hello, ${this.variables.someVariable}!`);
    return new Response('Hello from the AppCloudService!');
  }
}

export default new AppCloudService();
