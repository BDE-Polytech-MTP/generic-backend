import { AuthenticationService, JWTClaims } from './auth.service';
import { UsersService, UsersServiceError, UsersErrorType } from './users.service';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { mock, instance, when, anyString, spy, verify } from 'ts-mockito'
import { HashStrategy } from '../utils/hash';
import { User } from '../models';

chai.use(chaiAsPromised);

const { expect } = chai;

describe('Authentication service', () => {

    const hashStrategy: HashStrategy = { hash: (data) => data };

    let user: User = {
        email: 'the-email',
        password: 'the-password',
        bdeUUID: 'the-bde-uuid',
        firstname: 'the-firstname',
        lastname: 'the-lastname',
        specialtyName: 'the-specialty',
        specialtyYear: 1,
        uuid: 'the-uuid',
    };

    describe('authenticate method', () => {    

        it('should reject if the user does not exists', () => {
            let usersService = mock<UsersService>();
            when(usersService.findByEmail(anyString())).thenReject(new UsersServiceError('User not found', UsersErrorType.USER_NOT_EXISTS));
            let service = new AuthenticationService(instance(usersService), hashStrategy);

            expect(service.authenticate('the-email', 'the-password')).to.be.rejectedWith(UsersServiceError);
        });

        it('should reject if user exists but password does not match', () => {
            let usersService = mock<UsersService>();
            when(usersService.findByEmail('the-email')).thenResolve(user);
            let service = new AuthenticationService(instance(usersService), hashStrategy);

            expect(service.authenticate('the-email', 'wrong-password')).to.be.rejectedWith(Error);
        });

        it('should return the resolve if the user exists and the password is matching', () => {
            let usersService = mock<UsersService>();
            when(usersService.findByEmail('the-email')).thenResolve(user);
            let service = new AuthenticationService(instance(usersService), hashStrategy);

            expect(service.authenticate('the-email', 'the-password')).to.be.fulfilled;
        });

        it("should call hash function on given password", async () => {
            let usersService = mock<UsersService>();
            when(usersService.findByEmail('the-email')).thenResolve(user);
            const hashSpy = spy(hashStrategy);
            let service = new AuthenticationService(instance(usersService), hashStrategy);

            await service.authenticate('the-email', 'the-password');
            verify(hashSpy.hash('the-password')).once();
        });

    });

    describe('generateToken and verifyToken methods (IT)', () => {

        it('should encode and decode correctly and return encoded claims', async () => {
            let usersService = mock<UsersService>();
            let service = new AuthenticationService(instance(usersService), hashStrategy);

            let token = await service.generateToken(user);
            let claims = await service.verifyToken(token);
            
            /* Removing iat from claims, we don't want to check its value */
            Object.defineProperty(claims, 'iat', {
                value: undefined,
                enumerable: false,
            });

            expect(claims).to.be.eql(<JWTClaims>{
                bde_uuid: user.bdeUUID,
                firstname: user.firstname,
                lastname: user.lastname,
                uuid: user.uuid,
            });
        });

    });

});