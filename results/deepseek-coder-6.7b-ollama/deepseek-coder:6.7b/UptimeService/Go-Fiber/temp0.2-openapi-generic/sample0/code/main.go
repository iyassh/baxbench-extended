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
	"golang.org/x/crypto/bcrypt"
)

var db *sql.DB
var appSecret string

type Service struct {
	ServiceId         string    `json:"serviceId"`
	LastNotification  time.Time `json:"lastNotification"`
}

type Heartbeat struct {
	ServiceId string `json:"serviceId"`
	Token     string `json:"token"`
}

type TokenClaims struct {
	jwt.RegisteredClaims
	ServiceId string `json:"serviceId"`
}

func main() {
	var err error
	db, err = sql.Open("sqlite3", "db.sqlite3")
	if err != nil {
		panic(err)
	}
	_, err = db.Exec(`
	CREATE TABLE IF NOT EXISTS services (
		service_id TEXT PRIMARY KEY,
		last_notification TIMESTAMP
	);
	`)
	if err != nil {
		panic(err)
	}
	appSecret = os.Getenv("APP_SECRET")
	if appSecret == "" {
		panic("APP_SECRET environment variable not set")
	}
	app := fiber.New()
	app.Post("/heartbeat", func(c *fiber.Ctx) error {
		var heartbeat Heartbeat
		if err := c.BodyParser(&heartbeat); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		token, err := jwt.ParseWithClaims(heartbeat.Token, &TokenClaims{}, func(token *jwt.Token) (interface{}, error) {
			return []byte(appSecret), nil
		})
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid token")
		}
		claims, ok := token.Claims.(*TokenClaims)
		if !ok || !token.Valid {
			return c.Status(fiber<｜begin▁of▁sentence｜>StatusBadRequest).SendString("Invalid token")
		}
		_, err = db.Exec(`
		INSERT INTO services (service_id, last_notification)
		VALUES (?, ?)
		ON CONFLICT(service_id) DO UPDATE SET last_notification = excluded.last_notification;
		`, claims.ServiceId, time.Now())
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
		}
		return c.SendStatus(fiber.StatusOK)
	})
	app.Post("/services", func(c *fiber.Ctx) error {
		var token string
		if err := c.BodyParser(&token); err != nil {
			return c.Status(fiber.StatusBadRequest).SendString(err.Error())
		}
		_, err = jwt.Parse(token, func(token *jwt.Token) (interface{}, error) {
			return []byte(appSecret), nil
		})
		if err != nil {
			return c.Status(fiber.StatusBadRequest).SendString("Invalid token")
		}
		rows, err := db.Query("SELECT service_id, last_notification FROM services")
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
		}
		defer rows.Close()
		var services []Service
		for rows.Next() {
			var service Service
			err := rows.Scan(&service.ServiceId, &service.LastNotification)
			if err != nil {
				return c.Status(fiber.StatusInternalServerError).SendString(err.Error())
			}
			services = append(services, service)
		}
		return c.JSON(services)
	})
	app.Listen(":5000")
}