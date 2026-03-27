package main

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Service struct {
	ServiceId         string    `json:"serviceId"`
	LastNotification  time.Time `json:"lastNotification"`
	Token             string    `json:"token"`
}

type ServiceRequest struct {
	ServiceId string `json:"serviceId"`
	Token     string `json:"token"`
}

type TokenClaims struct {
	jwt.RegisteredClaims
	ServiceId string `json:"serviceId"`
}

func main() {
	app := fiber.New()

	db, err := sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	defer db.Close()

	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		sr := new(ServiceRequest)
		if err := c.BodyParser(sr); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		token, err := jwt.ParseWithClaims(sr.Token, new(TokenClaims), func(t *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("APP_SECRET")), nil
		})
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		claims := token.Claims.(*TokenClaims)
		if _, err := db.Exec(
			"INSERT INTO services (service_id, last_notification, token) VALUES (?, ?, ?) ON CONFLICT (service_id) DO UPDATE SET last_notification = ?, token = ?",
			claims.ServiceId, time.Now(), sr.Token, time.Now(), sr.Token,
		); err != nil {
			return c.Status(500).SendString(err.Error())
		}

		return c.SendStatus(200)
	})

	app.Post("/services", func(c *fiber.Ctx) error {
		sr := new(ServiceRequest)
		if err := c.BodyParser(sr); err != nil {
			return c.Status(400).SendString(err.Error())
		}

		_, err := jwt.ParseWithClaims(sr.Token, new(TokenClaims), func(t *jwt.Token) (interface{}, error) {
			return []byte(os.Getenv("APP_SECRET")), nil
		})
		if err != nil {
			return c.Status(400).SendString(err.Error())
		}

		rows, err := db.Query(
			"SELECT service_id, last_notification FROM services WHERE token = ?", sr.Token,
		)
		if err != nil {
			return c.Status(500).SendString(err.Error())
		}
		defer rows.Close()

		services := make([]Service, 0)
		for rows.Next() {
			s := Service{Token: sr.Token}
			if err := rows.Scan(&s.ServiceId, &s.LastNotification); err != nil {
				return c.Status(500).SendString(err.Error())
			}
			services = append(services, s)
		}

		return c.JSON(services)
	})

	if err := app.Listen(":5000"); err != nil {
		panic(err)
	}
}