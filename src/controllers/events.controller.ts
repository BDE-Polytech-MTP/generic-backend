import { EventsService, AuthenticationService, JWTClaims, EventsErrorType, LoggingService } from '../services';
import { ValidatorBuilder } from '../validation';
import { Event } from '../models';
import { DateTime } from 'luxon';
import { v4 as uuid } from 'uuid';
import * as httpCode from '../utils/http-code';
import { canManageEvents } from '../utils/permissions';

interface EventBodyRequest { name: string, bde: string, isDraft: boolean, bookingStart?: string, bookingEnd?: string, eventDate?: string };

export class EventsController {

    private static EVENT_VALIDATOR = ValidatorBuilder
                                        .new<EventBodyRequest>()
                                        .requires('name').toBeString().withMinLength(1).withMaxLength(200)
                                        .requires('bde').toBeString().withMinLength(1)
                                        .requires('isDraft').toBeBoolean()
                                        .optional('bookingStart').toBeDateTime()
                                        .optional('bookingEnd').toBeDateTime()
                                        .optional('eventDate').toBeDateTime()
                                        .build();

    constructor(private eventsService: EventsService, private authService: AuthenticationService, private loggingService: LoggingService) {}

    /**
     * Populates given instance with dates instance for each existing date in request data.
     * 
     * @param event The event instance
     * @param eventData The request data
     */
    private assignDates(event: Event, eventData: EventBodyRequest) {
        if (eventData.bookingStart) {
            event.bookingStart = DateTime.fromISO(eventData.bookingStart);
        }

        if (eventData.bookingEnd) {
            event.bookingEnd = DateTime.fromISO(eventData.bookingEnd);
        }

        if (eventData.eventDate) {
            event.eventDate = DateTime.fromISO(eventData.eventDate);
        }
    }

    /**
     * Checks if the beginning booking date if strictly before the end date for booking (if both are given).
     * 
     * @param event The event to check booking dates of
     */
    private areBookingDatesWellOrdered(event: Event): boolean {
        return event.bookingStart === undefined || event.bookingEnd === undefined || event.bookingStart < event.bookingEnd;
    }

    /**
     * Handles a request that aims to create an event.
     * 
     * @param body The request body
     * @param token The JWT to identify user
     */
    async create(body: object | null, token?: string): Promise<httpCode.Response> {

        /* No user token were given, we return an unauthorized error */
        if (!token) {
            return httpCode.unauthorized('You must be connected.');
        }

        /* Try to authenticate the user from the given token */
        let claims: JWTClaims;
        try {
            claims = await this.authService.verifyToken(token);
        } catch (_) {
            return httpCode.unauthorized('The given token is invalid.');
        }

        /* Validate request body */
        const result = EventsController.EVENT_VALIDATOR.validate(body);
        if (!result.valid) {
            return httpCode.badRequest(result.error.message);
        }

        let event: Event = {
            eventUUID: uuid(),
            bdeUUID: result.value.bde,
            eventName: result.value.name,
            isDraft: result.value.isDraft,
        };

        /* Assign dates instances */
        this.assignDates(event, result.value);

        /* We check booking dates order */
        if (!this.areBookingDatesWellOrdered(event)) {
            return httpCode.badRequest('Booking end date must come (strictly) after booking beginning date.');
        }

        /* Checking user permission */
        if (!canManageEvents(claims, result.value.bde)) {
            return httpCode.forbidden('You do not have the permission to create this event.');
        }

        try {
            event = await this.eventsService.create(event)
            return httpCode.created(event);
        } catch (e) {
            if (e.type === EventsErrorType.BDE_UUID_NOT_EXISTS) {
                return httpCode.badRequest('Given bde UUID does not exist.');
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to create an event. Contact an administrator or retry later.');
        }

    }

    /**
     * Handles a request that aims to retrieve an event.
     * 
     * @param eventUUID The UUID of the event to get
     * @param token The JWT to identify user
     */
    async findOne(eventUUID: string, token?: string): Promise<httpCode.Response> {

        /* Retrieve event using events service */
        let event: Event;
        try {
            event = await this.eventsService.findByUUID(eventUUID);
        } catch (e) {
            if (e.type === EventsErrorType.EVENT_NOT_EXISTS) {
                return httpCode.notFound('Not found');
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to fetch this event. Contact an adminstrator or retry later.');
        }

        /* If the event is a draft, the user must have the permission to manage events in order to fetch it */
        if (event.isDraft) {

            /* If no token was provided, we discard the request */
            if (!token) {
                return httpCode.unauthorized('You must authenticate to access this resource.');
            }
            
            /* We decode the received token */
            let user: JWTClaims;
            try {
                user = await this.authService.verifyToken(token);
            } catch (_) {
                return httpCode.unauthorized('The given token is invalid.');
            }

            /* If the user does not have the permission to manage this event, we discard the request */
            if (!canManageEvents(user, event.bdeUUID)) {
                return httpCode.forbidden('You do not have the permission to access this resource.');
            }

        }

        return httpCode.ok(event);
    }

    /**
     * Handles a request that aims to patch an event.
     * 
     * @param eventUUID The UUID of the event to patch
     * @param body The request body
     * @param token The JWT to identify user
     */
    async patchEvent(eventUUID: string, body: object | null, token?: string): Promise<httpCode.Response> {
        
        /* No user token were given, we return an unauthorized error */
        if (!token) {
            return httpCode.unauthorized('You must be connected.');
        }

        /* Try to authenticate the user from the given token */
        let claims: JWTClaims;
        try {
            claims = await this.authService.verifyToken(token);
        } catch (_) {
            return httpCode.unauthorized('The given token is invalid.');
        }

        /* Validate request body */
        const result = EventsController.EVENT_VALIDATOR.validate(body);
        if (!result.valid) {
            return httpCode.badRequest(result.error.message);
        }

        let event: Event = {
            eventUUID: eventUUID,
            bdeUUID: result.value.bde,
            eventName: result.value.name,
            isDraft: result.value.isDraft,
        };

        /* Assign dates instances */
        this.assignDates(event, result.value);

        /* We check booking dates order */
        if (!this.areBookingDatesWellOrdered(event)) {
            return httpCode.badRequest('bookingEnd date must come (strictly) after bookingStart date.');
        }

        /* Fetch event with the given UUID */
        let fetchedEvent: Event;
        try {
            fetchedEvent = await this.eventsService.findByUUID(event.eventUUID);
        } catch (e) {
            if (e.type === EventsErrorType.EVENT_NOT_EXISTS) {
                return httpCode.notFound(`No event with uuid ${event.eventUUID} exists.`);
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to patch the event. Please contact and adminstrator or retry later.');
        }

        /* If the request tries to change event's bde UUID, we check if the user has the permission to manage events for the new BDE */
        if (event.bdeUUID !== fetchedEvent.bdeUUID && !canManageEvents(claims, event.bdeUUID)) {
            return httpCode.forbidden('You do not have the permission to patch this event.');
        }

        /* Checking user permission */
        if (!canManageEvents(claims, fetchedEvent.bdeUUID)) {
            return httpCode.forbidden('You do not have the permission to patch this event.');
        }

        try {
            event = await this.eventsService.update(event)
            return httpCode.ok(event);
        } catch (e) {
            if (e.type === EventsErrorType.EVENT_NOT_EXISTS) {
                return httpCode.notFound(`No event with uuid ${event.eventUUID} exists.`);
            } else if (e.type === EventsErrorType.BDE_UUID_NOT_EXISTS) {
                return httpCode.badRequest(`No BDE with UUID ${event.bdeUUID} exists.`);
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to patch event. Contact an administrator or retry later.');
        }

    }

    /**
     * Deletes the event with the given UUID.
     * 
     * @param eventUUID The UUID of the event to delete
     * @param token The JWT allowing to identify the user
     */
    async deleteEvent(eventUUID: string, token?: string): Promise<httpCode.Response> {
        
        /* No user token were given, we return an unauthorized error */
        if (!token) {
            return httpCode.unauthorized('You must be connected.');
        }

        /* Try to authenticate the user from the given token */
        let claims: JWTClaims;
        try {
            claims = await this.authService.verifyToken(token);
        } catch (_) {
            return httpCode.unauthorized('The given token is invalid.');
        }

        /* Fetch event with the given UUID */
        let fetchedEvent: Event;
        try {
            fetchedEvent = await this.eventsService.findByUUID(eventUUID);
        } catch (e) {
            if (e.type === EventsErrorType.EVENT_NOT_EXISTS) {
                return httpCode.notFound(`No event with uuid ${eventUUID} exists.`);
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to delete the event. Please contact and adminstrator or retry later.');
        }

        /* Checking user permission */
        if (!canManageEvents(claims, fetchedEvent.bdeUUID)) {
            return httpCode.forbidden('You do not have the permission to patch this event.');
        }

        try {
            await this.eventsService.delete(eventUUID);
            return httpCode.noContent();
        } catch (e) {
            if (e.type === EventsErrorType.EVENT_NOT_EXISTS) {
                return httpCode.notFound(`No event with uuid ${eventUUID} exists.`);
            }
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to delete event. Contact an administrator or retry later.');
        }

    }

    /**
     * Handles a request that aims to list all known events.
     * 
     * @param token The JWT to identify user
     */
    async findAll(token?: string): Promise<httpCode.Response> {

        /* Fetching all events from database (maybe later add pagination and delegate events filtering to events service) */
        let events: Event[];
        try {
            events = await this.eventsService.findAll();
        } catch (e) {
            this.loggingService.error(e);
            return httpCode.internalServerError('Unable to list events.');
        }

        /* If a token is provided, we try to authenticate user */
        let jwtClaims: JWTClaims | null = null;
        if (token) {
            try {
                jwtClaims = await this.authService.verifyToken(token);
            } catch (_) {} // If token verification fails, we just handle request like no token were given
        }

        /* Only keep non-draft events and events manage-able by authenticated user (if so) */
        const filteredEvents = events.filter((event) => !event.isDraft || (jwtClaims !== null && canManageEvents(jwtClaims, event.bdeUUID)));

        return httpCode.ok(filteredEvents);
    }

}